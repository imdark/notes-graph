import { WinstonLogger } from 'nest-winston';

import { NotesGraphLogger as RawNotesGraphLogger } from '../../../base/logger';

export class NotesGraphLogger extends WinstonLogger {
  override error(
    message: any,
    stackOrError?: Error | string | unknown,
    context?: string
  ) {
    super.error(
      message,
      RawNotesGraphLogger.formatStack(stackOrError) as string,
      context
    );
  }
}
