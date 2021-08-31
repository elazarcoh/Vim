import { Disposable, Position } from 'vscode';
import { configuration } from '../../../configuration/configuration';
import { ValidatorResults } from '../../../configuration/iconfigurationValidator';
import { VimState } from '../../../state/vimState';
import { TextObject } from '../../../textobject/textobject';
import { Logger } from '../../../util/logger';
import { RegisterAction, unregisterByName } from '../../base';
import { failedMovement, IMovement } from '../../baseMotion';
import { maybeGetLeft, maybeGetRight, searchPosition } from './searchUtils';

export interface IUserTextObject {
  objectKeys: string[];
  open: string /*| { pattern: RegExp }*/;
  close: string /* | { pattern: RegExp }*/;
  possiblyMultiline?: boolean;
  supportsInside?: boolean;
  supportsAround?: boolean;
  includeOpenWhenAround?: boolean;
  includeCloseWhenAround?: boolean;
  languageIds?: string[] | '*';

  // supportsNext: boolean;
  // supportsLast: boolean;
}

function valid(config: IUserTextObject) {
  return (
    config.objectKeys !== undefined &&
    typeof config.open === 'string' &&
    typeof config.close === 'string'
  );
}

class UserTextObject extends TextObject {
  public override readonly keys: readonly string[] | readonly string[][];
  readonly open: string /*| { pattern: RegExp }*/;
  readonly close: string /* | { pattern: RegExp }*/;
  readonly possiblyMultiline: boolean;
  readonly includeOpenWhenAround: boolean;
  readonly includeCloseWhenAround: boolean;
  languageIds: '*' | string[];

  constructor(definition: IUserTextObject) {
    super();
    this.keys = [
      ['i', ...definition.objectKeys],
      ['a', ...definition.objectKeys],
    ];
    this.open = definition.open;
    this.close = definition.close;
    this.possiblyMultiline = definition.possiblyMultiline ?? false;
    this.includeOpenWhenAround = definition.includeOpenWhenAround ?? true;
    this.includeCloseWhenAround = definition.includeCloseWhenAround ?? true;
    this.languageIds = definition.languageIds ?? '*';
  }

  public override async execAction(position: Position, vimState: VimState): Promise<IMovement> {
    if (this.languageIds !== '*' && !this.languageIds.includes(vimState.document.languageId)) {
      return failedMovement(vimState);
    }

    const isAround = vimState.recordedState.actionKeys[0] === 'a';
    const left = searchPosition(this.open, vimState.document, position, {
      direction: '<',
      includeCursor: true,
      throughLineBreaks: this.possiblyMultiline,
    });
    if (left === undefined) {
      return failedMovement(vimState);
    }

    const right = searchPosition(this.close, vimState.document, position, {
      direction: '>',
      includeCursor: left !== position,
      throughLineBreaks: this.possiblyMultiline,
    });
    if (right === undefined) {
      return failedMovement(vimState);
    }

    return {
      start: maybeGetRight(left, {
        count: this.open.length,
        throughLineBreaks: this.possiblyMultiline,
        dontMove: isAround && this.includeOpenWhenAround,
      }),
      stop: maybeGetLeft(
        right.getOffsetThroughLineBreaks(this.close.length - 1), // because right is on the starting point
        {
          count: this.close.length,
          throughLineBreaks: this.possiblyMultiline,
          dontMove: isAround && this.includeCloseWhenAround,
        }
      ),
    };
  }
}

class UserTextObjectRegistry {
  public register(definition: IUserTextObject) {
    const UserTextObjectAction = class extends UserTextObject {
      constructor() {
        super(definition);
      }
    };
    RegisterAction(UserTextObjectAction);
  }

  public async updateFromConfig() {
    unregisterByName('UserTextObjectAction');
    const customTextObjects = (configuration.customTextObjects as IUserTextObject[]) ?? {};
    for (const config of customTextObjects) {
      const err = `failed to register user text object for keys: [${config.objectKeys}]`;
      if (valid(config)) {
        try {
          this.register(config);
        } catch {
          Logger.get('UserTextObject').error(err);
        }
      } else {
        Logger.get('UserTextObject').error(err);
      }
    }
  }
}

export const userTextObjectRegistry = new UserTextObjectRegistry();
