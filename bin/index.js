#!/usr/bin/env node

/*!
 * Command line tools for Back2Front
 * 命令入口
 */

'use strict';

var path = require('path'),
	fs = require('fs'),
	argvs = require('minimist')( process.argv.slice(2) ),
	jsonFormat = require('json-format'),
	errorExit = require('../lib/util').errorExit;


var fn;
switch (argvs._[0]) {
	case 'build':
		fn = require('../build');
		break;

	case 'depa':
		fn = require('../depa');
		break;

	default:
		errorExit('Please use "back2front build" or "back2front depa"');
}


// 检查项目路径是否存在
var pjPath = argvs._[1];
if (pjPath) {
	pjPath = path.resolve(pjPath);
	if ( !fs.existsSync(pjPath) ) {
		errorExit('"' + pjPath + '" does not exist');
	}
} else {
	errorExit('Please specify project path');
}

// 检查构建配置文件是否存在
var configPath = path.join(pjPath, 'build.json');
if ( !fs.existsSync(configPath) ) {
	errorExit('Configuration file not found.');
}

var result = fn( pjPath, argvs, require(configPath) );

if (argvs._[0] === 'depa') {
	result.then(function(map) {
		if (argvs.o) {
			fs.writeFileSync(
				path.resolve(argvs.o),
				jsonFormat(map),
				'utf-8'
			);
		} else {
			console.dir(map);
		}
	});
}