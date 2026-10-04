import * as styles from './tool-input.css';
import type { ToolInputPreview } from './tool-input';

/** The input of a tool an agent wants permission for, laid out to read. */
export const ToolInputView = ({ preview }: { preview: ToolInputPreview }) => (
  <div className={styles.input} data-testid="agent-tool-input">
    {preview.description ? (
      <p className={styles.description}>{preview.description}</p>
    ) : null}
    {preview.command !== null ? (
      <pre className={styles.command} data-testid="agent-tool-command">
        {preview.command}
      </pre>
    ) : null}
    {preview.fields.length > 0 ? (
      <dl className={styles.fields}>
        {preview.fields.map((f, i) => (
          <div key={i} className={f.block ? styles.blockField : styles.field}>
            <dt className={styles.label}>{f.label}</dt>
            <dd className={f.block ? styles.blockValue : styles.value}>
              {f.value}
            </dd>
          </div>
        ))}
      </dl>
    ) : null}
  </div>
);
