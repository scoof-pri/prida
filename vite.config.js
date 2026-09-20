import {defineConfig} from 'vite';
export default defineConfig({base:'./',build:{target:'es2022',chunkSizeWarningLimit:3000},server:{host:'0.0.0.0',allowedHosts:['terminal.local']}});
