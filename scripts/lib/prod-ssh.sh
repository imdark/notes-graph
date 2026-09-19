# Shared SSH access to the prod box, sourced by deploy-prod.sh and prod-exec.sh.
#
# The box only allows port 22 from allow-listed IPs, so a rotating home IP
# silently breaks SSH. These helpers probe first and open ingress via the AWS
# CLI when needed, running 'aws login' interactively if the session expired.
#
# Sourcing sets HOST / SSH_KEY / SSH unless the caller already set them, and
# defines ssh_probe, ensure_aws_auth, open_ssh_ingress and ensure_ssh_access.
# Override targets with NOTESGRAPH_DEPLOY_HOST / _KEY / _REGION / _SG.

HOST="${NOTESGRAPH_DEPLOY_HOST:-18.225.203.37}"
SSH_KEY="${NOTESGRAPH_DEPLOY_KEY:-$HOME/.ssh/notesgraph-prod.pem}"
# Keepalives: a stalled connection errors out in ~2 minutes instead of
# hanging the deploy forever (the remote build step is a long-lived session).
SSH=(ssh -i "$SSH_KEY" -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=8 "ubuntu@$HOST")

# AWS bits for auto-opening SSH when this machine's IP isn't allowlisted.
AWS_REGION_="${NOTESGRAPH_DEPLOY_REGION:-us-east-2}"
DEPLOY_SG="${NOTESGRAPH_DEPLOY_SG:-}"   # optional; auto-derived from HOST if empty

# True if we can open an SSH session to the box right now.
ssh_probe() {
  ssh -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=10 \
    -o StrictHostKeyChecking=accept-new "ubuntu@$HOST" 'true' >/dev/null 2>&1
}

# Make sure the AWS CLI has a live session, logging in interactively if not.
ensure_aws_auth() {
  command -v aws >/dev/null 2>&1 || {
    echo "!! aws CLI not installed — can't auto-open SSH. Install it or add your IP to the security group manually." >&2
    return 1
  }
  if aws sts get-caller-identity >/dev/null 2>&1; then
    return 0
  fi
  echo "==> AWS session missing/expired — launching interactive login (a browser may open)"
  # 'aws login' is this environment's configured re-auth entrypoint.
  aws login || {
    echo "!! 'aws login' failed. Authenticate manually, then re-run." >&2
    return 1
  }
  aws sts get-caller-identity >/dev/null 2>&1
}

# Add this machine's public IP to the box's SSH (tcp/22) ingress rule.
open_ssh_ingress() {
  ensure_aws_auth || return 1

  local sg="$DEPLOY_SG"
  if [[ -z "$sg" ]]; then
    sg="$(aws ec2 describe-instances --region "$AWS_REGION_" \
      --filters "Name=ip-address,Values=$HOST" \
      --query 'Reservations[].Instances[].SecurityGroups[].GroupId' \
      --output text 2>/dev/null | tr '\t' '\n' | head -1)"
  fi
  [[ -n "$sg" ]] || { echo "!! couldn't resolve a security group for $HOST" >&2; return 1; }

  local myip
  myip="$(curl -fsS --max-time 10 https://api.ipify.org)" \
    || { echo "!! couldn't determine this machine's public IP" >&2; return 1; }

  echo "==> authorizing SSH (tcp/22) from $myip/32 on $sg"
  # Idempotent: a duplicate rule just means we're already allowed.
  aws ec2 authorize-security-group-ingress --region "$AWS_REGION_" --group-id "$sg" \
    --ip-permissions "IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=$myip/32,Description=deploy-prod-$(whoami)-$(date +%Y%m%d)}]" \
    >/dev/null 2>&1 \
    && echo "==> ingress rule added (remember to revoke it later if this is a dynamic IP)" \
    || echo "==> ingress rule already present (or add failed) — continuing"
}

# Guarantee SSH works before any ssh/scp/rsync; open the port via AWS if needed.
ensure_ssh_access() {
  if ssh_probe; then return 0; fi
  echo "==> SSH to $HOST is unreachable — attempting to open port 22 for this machine"
  open_ssh_ingress || { echo "!! could not open SSH access automatically" >&2; exit 1; }
  local i
  for i in 1 2 3 4 5; do
    if ssh_probe; then echo "==> SSH reachable"; return 0; fi
    sleep 3
  done
  echo "!! SSH to $HOST still unreachable after opening ingress" >&2
  exit 1
}
