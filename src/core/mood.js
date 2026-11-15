export const MOODS = ['waiting', 'running', 'worried', 'alarmed', 'success', 'failed'];

export function moodOf({ status, counts, warnings }) {
  const started = counts.success + counts.warn + counts.error + counts.skipped + counts.running;
  if (status === 'running') {
    if (counts.error) return 'alarmed';
    if (counts.warn || warnings) return 'worried';
    return started ? 'running' : 'waiting';
  }
  return status === 'error' || counts.error || counts.skipped ? 'failed' : 'success';
}
