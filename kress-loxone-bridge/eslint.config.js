'use strict';
const js=require('@eslint/js');
const globals=require('globals');
module.exports=[{ignores:['node_modules/**']},js.configs.recommended,{languageOptions:{sourceType:'commonjs',globals:globals.node},rules:{'no-unused-vars':['error',{argsIgnorePattern:'^_',caughtErrors:'none'}],'no-empty':['error',{allowEmptyCatch:true}]}}];
