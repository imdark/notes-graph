import { TEST_DOC } from '../common';
import {
  Button,
  Content,
  Doc,
  type DocProps,
  P,
  Template,
  Title,
} from '../components';

export type MonitorAlertProps = {
  monitor: { name: string; value: string; previous?: string; reason: string };
  doc: DocProps;
};

export function MonitorAlert(props: MonitorAlertProps) {
  const { monitor, doc } = props;
  return (
    <Template>
      <Title>{monitor.name}</Title>
      <Content>
        <P>
          Now <b>{monitor.value}</b>
          {monitor.previous ? <> (was {monitor.previous})</> : null} —{' '}
          {monitor.reason}. It is kept up to date in <Doc {...doc} />.
        </P>
        <Button href={doc.url}>Open Doc</Button>
      </Content>
    </Template>
  );
}

MonitorAlert.PreviewProps = {
  monitor: {
    name: 'RTX 5090 at Micro Center',
    value: '$1,899',
    previous: '$1,999',
    reason: 'below 1900',
  },
  doc: TEST_DOC,
};
