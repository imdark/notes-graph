import {
  DiscordIcon,
  GithubIcon,
  RedditIcon,
  TwitterIcon,
  YouTubeIcon,
} from './icons';

export const relatedLinks = [
  {
    icon: <GithubIcon />,
    title: 'GitHub',
    link: 'https://github.com/notesgraph/notesgraph',
  },
  {
    icon: <TwitterIcon />,
    title: 'X',
    link: 'https://twitter.com/NotesGraphOfficial',
  },
  {
    icon: <DiscordIcon />,
    title: 'Discord',
    link: BUILD_CONFIG.discordUrl,
  },
  {
    icon: <YouTubeIcon />,
    title: 'YouTube',
    link: 'https://www.youtube.com/@notesgraphpro',
  },
  {
    icon: <RedditIcon />,
    title: 'Reddit',
    link: 'https://www.reddit.com/r/NotesGraph/',
  },
];
