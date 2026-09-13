import { checkField } from './check.js';
import 'overscan/src/tokens.css';
import 'overscan/field';

checkField(import.meta.env.DEV ? 'vite dev' : 'vite build');
