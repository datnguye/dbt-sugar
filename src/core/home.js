import os from 'node:os';
import path from 'node:path';

export function sugarHome(env = process.env, home = os.homedir()) {
  return env.DBT_SUGAR_HOME || path.join(home, '.dbt-sugar');
}
