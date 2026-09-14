import { ThemeProvider } from '@notesgraph/core/components/theme-provider';
import { configureElectronStateStorageImpls } from '@notesgraph/core/desktop/storage';
import { configureDesktopApiModule } from '@notesgraph/core/modules/desktop-api';
import {
  configureI18nModule,
  I18nProvider,
} from '@notesgraph/core/modules/i18n';
import { configureStorageModule } from '@notesgraph/core/modules/storage';
import { configureEssentialThemeModule } from '@notesgraph/core/modules/theme';
import { appInfo } from '@notesgraph/electron-api';
import { Framework, FrameworkRoot } from '@notesgraph/infra';

import * as styles from './app.css';
import { Recording } from './recording';

const framework = new Framework();
configureI18nModule(framework);
configureEssentialThemeModule(framework);
configureStorageModule(framework);
configureElectronStateStorageImpls(framework);
configureDesktopApiModule(framework);
const frameworkProvider = framework.provider();

const mode = appInfo?.windowName as 'notification' | 'recording';

export function App() {
  return (
    <FrameworkRoot framework={frameworkProvider}>
      <ThemeProvider>
        <I18nProvider>
          <div className={styles.root} data-is-windows={environment.isWindows}>
            {mode === 'recording' && <Recording />}
          </div>
        </I18nProvider>
      </ThemeProvider>
    </FrameworkRoot>
  );
}
