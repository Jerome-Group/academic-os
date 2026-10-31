import { resolve } from 'node:path';
import { boundedJson } from './bounded-json.mjs';
import { prepareAcademicOsTaskPlan, assessAcademicOsTaskResult } from './academic-os-task-plan.mjs';
import { buildAcademicOsPlanningCatalog, acquireAcademicOsTaskPlan, discoverAcademicOsPlanningAuthorizations, revalidateAcademicOsTaskPlan, validateAcademicOsPlanningCatalog } from './academic-os-planning.mjs';

const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
export const academicOsPlanningReadyStatuses = Object.freeze(['api-plan-ready-reported', 'api-applied-reported', 'planning-catalog-ready', 'planning-catalog-valid', 'planning-authorizations-discovered', 'api-plan-current-reported']);

export async function readAcademicOsPlanningRequest(file) {
  const request = await boundedJson(resolve(file), 32 * 1024 * 1024);
  const stages = { validate: ['catalog'], publish: ['catalog'], discover: ['catalog', 'selector'], acquire: ['catalog', 'request', 'observation'], revalidate: ['catalog', 'prepared', 'observation'], prepare: ['intent', 'observation'], receipt: ['prepared', 'receipt'] };
  requireValue(request?.schemaVersion === 1 && Object.hasOwn(stages, request.stage) && Object.keys(request).every(key => ['schemaVersion', 'stage', ...stages[request.stage]].includes(key)), 'Use a versioned Academic OS validate, publish, discover, acquire, revalidate, prepare or receipt request');
  const options = { evaluatedAt: new Date().toISOString() };
  if (request.stage === 'validate') {
    const catalog = validateAcademicOsPlanningCatalog(request.catalog, options);
    return { schemaVersion: 1, status: 'planning-catalog-valid', execution: 'none', policyVersion: catalog.policyVersion, scope: catalog.scope };
  }
  if (request.stage === 'publish') return { schemaVersion: 1, status: 'planning-catalog-ready', execution: 'none', catalog: buildAcademicOsPlanningCatalog(request.catalog, options), limits: ['Exported data does not authenticate cloud authorship or install service authority. Publish through the existing authorized bridge into the configured trusted source.'] };
  if (request.stage === 'discover') return discoverAcademicOsPlanningAuthorizations(request.catalog, request.selector, options);
  if (request.stage === 'revalidate') return revalidateAcademicOsTaskPlan(request.catalog, request.prepared, request.observation, options);
  if (request.stage === 'acquire') return acquireAcademicOsTaskPlan(request.catalog, request.request, request.observation, options);
  return request.stage === 'prepare' ? prepareAcademicOsTaskPlan(request.intent, request.observation, options) : assessAcademicOsTaskResult(request.prepared, request.receipt, options);
}
