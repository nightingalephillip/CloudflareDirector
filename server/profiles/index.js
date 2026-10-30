import * as generic from './generic.js';
import * as havoc from './havoc.js';
import * as mythic from './mythic.js';
import * as sliver from './sliver.js';

const EXPORTERS = { generic, havoc, mythic, sliver };

export function exportProfile(framework, chain, settings, options = {}) {
  const exporter = EXPORTERS[framework];
  if (!exporter) throw new Error('Unknown framework: ' + framework + ' (use generic|havoc|mythic|sliver)');
  return exporter.build(chain, settings, options);
}

export { EXPORTERS };
