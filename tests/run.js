// gjs -m tests/run.js
import System from 'system';
import {run} from './harness.js';
import './ledger.test.js';
import './gsi.test.js';
import './roshan.test.js';

System.exit(await run() ? 1 : 0);
