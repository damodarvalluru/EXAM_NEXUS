/**
 * ExamNexus short spike scenario: 0 -> VUS in 10s, hold 1m, back to 0 in 10s.
 *
 * Reuses the credential validation, login, setup summary and candidate journey
 * from candidate-flow.js. Same warning applies: STAGING ONLY, credentials required.
 * VUS defaults to 200; override with `k6 run -e VUS=...`.
 */
import { sleep } from 'k6';
import { CONFIG, THRESHOLDS, assertConfig, setupCandidate, runCandidateFlow } from './candidate-flow.js';

export { handleSummary } from './candidate-flow.js';

assertConfig();

export const options = {
  thresholds: THRESHOLDS,
  scenarios: {
    spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: CONFIG.vus },
        { duration: '1m', target: CONFIG.vus },
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'max'],
};

export const setup = setupCandidate;

export default function (data) {
  runCandidateFlow(data);
  sleep(1);
}
