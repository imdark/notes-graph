import { cssVarV2 } from '@toeverything/theme/v2';

export type SelectOptionColor = {
  oldColor: string;
  color: string;
  name: string;
};
export const selectOptionColors: SelectOptionColor[] = [
  {
    oldColor: 'var(--notesgraph-tag-red)',
    color: cssVarV2('chip/label/red'),
    name: 'Red',
  },
  {
    oldColor: 'var(--notesgraph-tag-pink)',
    color: cssVarV2('chip/label/magenta'),
    name: 'Magenta',
  },
  {
    oldColor: 'var(--notesgraph-tag-orange)',
    color: cssVarV2('chip/label/orange'),
    name: 'Orange',
  },
  {
    oldColor: 'var(--notesgraph-tag-yellow)',
    color: cssVarV2('chip/label/yellow'),
    name: 'Yellow',
  },
  {
    oldColor: 'var(--notesgraph-tag-green)',
    color: cssVarV2('chip/label/green'),
    name: 'Green',
  },
  {
    oldColor: 'var(--notesgraph-tag-teal)',
    color: cssVarV2('chip/label/teal'),
    name: 'Teal',
  },
  {
    oldColor: 'var(--notesgraph-tag-blue)',
    color: cssVarV2('chip/label/blue'),
    name: 'Blue',
  },
  {
    oldColor: 'var(--notesgraph-tag-purple)',
    color: cssVarV2('chip/label/purple'),
    name: 'Purple',
  },
  {
    oldColor: 'var(--notesgraph-tag-gray)',
    color: cssVarV2('chip/label/grey'),
    name: 'Grey',
  },
  {
    oldColor: 'var(--notesgraph-tag-white)',
    color: cssVarV2('chip/label/white'),
    name: 'White',
  },
];

const oldColorMap = Object.fromEntries(
  selectOptionColors.map(tag => [tag.oldColor, tag.color])
);

export const getColorByColor = (color: string) => {
  if (color.startsWith('--notesgraph-tag')) {
    return oldColorMap[color] ?? color;
  }
  return color;
};

/** select tag color poll */
const selectTagColorPoll = selectOptionColors.map(color => color.color);

function tagColorHelper() {
  let colors = [...selectTagColorPoll];
  return (): string => {
    if (colors.length === 0) {
      colors = [...selectTagColorPoll];
    }
    const index = Math.floor(Math.random() * colors.length);
    const color = colors.splice(index, 1)[0];
    if (!color) return '';
    return color;
  };
}

export const getTagColor = tagColorHelper();
