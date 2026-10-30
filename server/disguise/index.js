// Benign single-file pages served to unauthenticated visitors and used as the
// failure/kill-switch response. No external requests, no JS frameworks —
// anything fetched remotely would show up in someone's devtools.
import { PORTFOLIO_HTML } from './portfolio.js';
import { BLOG_HTML } from './blog.js';
import { BUSINESS_HTML } from './business.js';

export const TEMPLATES = [
  { id: 'portfolio', name: 'Personal portfolio', description: 'Freelance developer site' },
  { id: 'blog', name: 'Tech blog', description: 'Static long-form blog index' },
  { id: 'business', name: 'Small business', description: 'Consulting company landing page' },
];

export function getDisguiseHtml(hop) {
  if (hop.disguise === 'custom' && hop.disguiseCustom) return hop.disguiseCustom;
  switch (hop.disguise) {
    case 'blog':
      return BLOG_HTML;
    case 'business':
      return BUSINESS_HTML;
    case 'portfolio':
    default:
      return PORTFOLIO_HTML;
  }
}
