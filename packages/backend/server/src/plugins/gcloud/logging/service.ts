import { LoggerService, Provider } from '@nestjs/common';
import { createLogger, format, transports } from 'winston';

import { NotesGraphLogger as LoggerProvide } from '../../../base/logger';
import { NotesGraphLogger } from './logger';

const moreMetadata = format(info => {
  info.requestId = LoggerProvide.getRequestId();
  return info;
});

export const LoggerProvider: Provider<LoggerService> = {
  provide: LoggerProvide,
  useFactory: () => {
    const instance = createLogger({
      level: env.namespaces.canary ? 'debug' : 'info',
      transports: [new transports.Console()],
      format: format.combine(moreMetadata(), format.json()),
    });
    return new NotesGraphLogger(instance);
  },
};
