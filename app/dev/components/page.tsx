import '../../styles/tokens.css';
import '../../styles/ui.css';
import './dev.css';
import Gallery from './gallery';

export const metadata = {
  title: 'OneTable — components (dev)',
  description: 'WP-0.6 base component gallery (PRD §16.8).',
};

/**
 * WP-0.6 dev gallery: /dev/components (PRD §16.8 — "a Storybook or
 * /dev/components page"). Internal-only surface; gating it out of production
 * is handled with the CI/env work in WP-0.3+.
 */
export default function DevComponentsPage() {
  return <Gallery />;
}
