import { resolve } from 'node:path';

export default {
  build: {
    rollupOptions: {
      input: {
        field: resolve(import.meta.dirname, 'field.html'),
        react: resolve(import.meta.dirname, 'react.html'),
        reactonly: resolve(import.meta.dirname, 'reactonly.html'),
      },
    },
  },
};
