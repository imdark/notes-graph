#!/usr/bin/env bash
#
# One-time AWS setup for deploying prod from GitHub Actions, with no SSH and
# no stored AWS keys. Safe to re-run: each step skips what already exists.
#
#   scripts/prod/setup-github-deploy-aws.sh
#
# Creates:
#   - notesgraph-prod-box: the box's instance role. SSM (so a deploy runs a
#     command on it without port 22) and pull from the notesgraph ECR repo.
#     Attached to the instance as a profile; no restart needed.
#   - the GitHub OIDC provider, so a workflow gets short-lived AWS credentials.
#   - notesgraph-github-deploy: the role a workflow assumes. Trusted only for
#     jobs in imdark/notes-graph's `production` environment; can push/pull the
#     notesgraph ECR repo and run AWS-RunShellScript on the prod box, nothing
#     else.
#   - a lifecycle rule keeping the newest 10 images in ECR.
#
# The ECR repo itself (notesgraph, us-east-2) must already exist.
set -euo pipefail

ACCOUNT=726029337107
REGION=us-east-2
INSTANCE=i-025bea042bd6b9b1d
REPO=notesgraph
GITHUB_REPO=imdark/notes-graph
BOX_ROLE=notesgraph-prod-box
DEPLOY_ROLE=notesgraph-github-deploy
OIDC_ARN="arn:aws:iam::$ACCOUNT:oidc-provider/token.actions.githubusercontent.com"
ECR_ARN="arn:aws:ecr:$REGION:$ACCOUNT:repository/$REPO"

log() { printf '\033[36m==>\033[0m %s\n' "$*"; }

# --- the box -----------------------------------------------------------------

if ! aws iam get-role --role-name "$BOX_ROLE" >/dev/null 2>&1; then
  log "creating role $BOX_ROLE"
  aws iam create-role --role-name "$BOX_ROLE" \
    --description "NotesGraph prod EC2 box: SSM + ECR pull" \
    --assume-role-policy-document '{
      "Version": "2012-10-17",
      "Statement": [{"Effect": "Allow", "Principal": {"Service": "ec2.amazonaws.com"}, "Action": "sts:AssumeRole"}]
    }' >/dev/null
fi
aws iam attach-role-policy --role-name "$BOX_ROLE" \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
aws iam put-role-policy --role-name "$BOX_ROLE" --policy-name ecr-pull \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {"Effect": "Allow", "Action": "ecr:GetAuthorizationToken", "Resource": "*"},
      {"Effect": "Allow",
       "Action": ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"],
       "Resource": "'"$ECR_ARN"'"}
    ]
  }'

if ! aws iam get-instance-profile --instance-profile-name "$BOX_ROLE" >/dev/null 2>&1; then
  log "creating instance profile $BOX_ROLE"
  aws iam create-instance-profile --instance-profile-name "$BOX_ROLE" >/dev/null
  aws iam add-role-to-instance-profile --instance-profile-name "$BOX_ROLE" --role-name "$BOX_ROLE"
  # A new profile takes a few seconds before EC2 can see it.
  sleep 10
fi

CURRENT_PROFILE="$(aws ec2 describe-iam-instance-profile-associations --region "$REGION" \
  --filters "Name=instance-id,Values=$INSTANCE" \
  --query 'IamInstanceProfileAssociations[0].IamInstanceProfile.Arn' --output text)"
if [[ "$CURRENT_PROFILE" == "None" ]]; then
  log "attaching $BOX_ROLE to $INSTANCE"
  aws ec2 associate-iam-instance-profile --region "$REGION" --instance-id "$INSTANCE" \
    --iam-instance-profile "Name=$BOX_ROLE" >/dev/null
elif [[ "$CURRENT_PROFILE" != *"/$BOX_ROLE" ]]; then
  echo "!! $INSTANCE already has profile $CURRENT_PROFILE; not replacing it" >&2
  exit 1
fi

# --- GitHub --------------------------------------------------------------------

if ! aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$OIDC_ARN" >/dev/null 2>&1; then
  log "adding the GitHub OIDC provider"
  # AWS no longer checks the thumbprint for GitHub, but the API still wants one.
  aws iam create-open-id-connect-provider --url https://token.actions.githubusercontent.com \
    --client-id-list sts.amazonaws.com \
    --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 >/dev/null
fi

TRUST='{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Federated": "'"$OIDC_ARN"'"},
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {"StringEquals": {
      "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
      "token.actions.githubusercontent.com:sub": "repo:'"$GITHUB_REPO"':environment:production"
    }}
  }]
}'
if aws iam get-role --role-name "$DEPLOY_ROLE" >/dev/null 2>&1; then
  aws iam update-assume-role-policy --role-name "$DEPLOY_ROLE" --policy-document "$TRUST"
else
  log "creating role $DEPLOY_ROLE"
  aws iam create-role --role-name "$DEPLOY_ROLE" \
    --description "GitHub Actions prod deploy for $GITHUB_REPO" \
    --assume-role-policy-document "$TRUST" >/dev/null
fi
aws iam put-role-policy --role-name "$DEPLOY_ROLE" --policy-name deploy \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {"Effect": "Allow", "Action": "ecr:GetAuthorizationToken", "Resource": "*"},
      {"Effect": "Allow",
       "Action": ["ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer",
                  "ecr:InitiateLayerUpload", "ecr:UploadLayerPart", "ecr:CompleteLayerUpload", "ecr:PutImage"],
       "Resource": "'"$ECR_ARN"'"},
      {"Effect": "Allow", "Action": "ssm:SendCommand",
       "Resource": ["arn:aws:ec2:'"$REGION:$ACCOUNT"':instance/'"$INSTANCE"'",
                    "arn:aws:ssm:'"$REGION"'::document/AWS-RunShellScript"]},
      {"Effect": "Allow", "Action": ["ssm:GetCommandInvocation", "ssm:ListCommandInvocations"], "Resource": "*"}
    ]
  }'

# --- ECR -----------------------------------------------------------------------

aws ecr put-lifecycle-policy --region "$REGION" --repository-name "$REPO" \
  --lifecycle-policy-text '{
    "rules": [{"rulePriority": 1, "description": "keep the newest 10 images",
               "selection": {"tagStatus": "any", "countType": "imageCountMoreThan", "countNumber": 10},
               "action": {"type": "expire"}}]
  }' >/dev/null

log "done"
echo "    deploy role: arn:aws:iam::$ACCOUNT:role/$DEPLOY_ROLE"
echo "    SSM sees the box within a few minutes if its agent is running:"
echo "    aws ssm describe-instance-information --region $REGION --query 'InstanceInformationList[].[InstanceId,PingStatus]'"
