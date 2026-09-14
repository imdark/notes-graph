import {
  BulletedList01Icon,
  BulletedList02Icon,
  BulletedList03Icon,
  BulletedList04Icon,
  CheckBoxCheckSolidIcon,
  CheckBoxUnIcon,
  ToggleDownIcon,
  ToggleRightIcon,
} from '@blocksuite/icons/lit';
import type { ListBlockModel } from '@blocksuite/notesgraph-model';
import { getNumberPrefix } from '@blocksuite/notesgraph-shared/utils';
import { html } from 'lit';

const getListDeep = (model: ListBlockModel): number => {
  let deep = 0;
  let parent = model.store.getParent(model);
  while (parent?.flavour === model.flavour) {
    deep++;
    parent = model.store.getParent(parent);
  }
  return deep;
};

const BulletIcons = [
  BulletedList01Icon({ width: '24px', height: '24px' }),
  BulletedList02Icon({ width: '24px', height: '24px' }),
  BulletedList03Icon({ width: '24px', height: '24px' }),
  BulletedList04Icon({ width: '24px', height: '24px' }),
];

export function getListIcon(
  model: ListBlockModel,
  showChildren: boolean,
  onClick: (e: MouseEvent) => void
) {
  const deep = getListDeep(model);
  switch (model.props.type) {
    case 'bulleted':
      return html`<div
        contenteditable="false"
        class="notesgraph-list-block__prefix"
        @click=${onClick}
      >
        ${BulletIcons[deep % BulletIcons.length]}
      </div>`;
    case 'numbered':
      return html`<div
        contenteditable="false"
        class="notesgraph-list-block__prefix notesgraph-list-block__numbered"
        @click=${onClick}
      >
        ${model.props.order ? getNumberPrefix(model.props.order, deep) : '1.'}
      </div>`;
    case 'todo':
      // The hover bullet left of the checkbox is the outline-zoom handle —
      // bulleted/numbered markers zoom on click, but a todo's prefix click
      // must keep toggling the checkbox, so todos get this separate,
      // hover-revealed affordance instead. Click handling lives with the
      // outline-zoom feature (frontend), keyed off the class.
      return html`<div
          contenteditable="false"
          class="notesgraph-list-block__zoom-handle"
        >
          ${BulletIcons[deep % BulletIcons.length]}
        </div>
        <div
          contenteditable="false"
          class=${`notesgraph-list-block__prefix notesgraph-list-block__todo-prefix ${model.store.readonly ? 'readonly' : ''}`}
          @click=${onClick}
        >
          ${model.props.checked
            ? CheckBoxCheckSolidIcon({ style: 'color: #1E96EB' })
            : CheckBoxUnIcon()}
        </div>`;
    case 'toggle':
      return html`<div
        contenteditable="false"
        class="notesgraph-list-block__prefix"
        @click=${onClick}
      >
        ${showChildren ? ToggleDownIcon() : ToggleRightIcon()}
      </div>`;
    default:
      console.error('Unknown list type', model.props.type, model);
      return null;
  }
}
