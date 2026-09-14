import type { ReactNode } from 'react';

import { NotesGraphIconRenderer } from './renderer/notesgraph-icon';
import { type IconData, IconType } from './type';

export const IconRenderer = ({
  data,
  fallback,
}: {
  data?: IconData;
  fallback?: ReactNode;
}) => {
  if (!data) {
    return fallback ?? null;
  }

  if (data.type === IconType.Emoji && data.unicode) {
    return data.unicode;
  }
  if (data.type === IconType.NotesGraphIcon && data.name) {
    return <NotesGraphIconRenderer name={data.name} color={data.color} />;
  }
  if (data.type === IconType.Blob && data.url) {
    return (
      <img
        src={data.url}
        alt=""
        style={{
          width: '1em',
          height: '1em',
          borderRadius: '0.15em',
          objectFit: 'cover',
          verticalAlign: '-0.125em',
        }}
      />
    );
  }

  return fallback ?? null;
};
