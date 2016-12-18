/*!
 * Command line tools for Back2Front
 * 构建
 */

'use strict';

var path = require('path'),
	fs = require('fs'),
	util = require('./lib/util'),
	errorExit = util.errorExit;


// node bin/index build /Users/HeeroLaw/Projects/back2front --env test --rev 20161217
module.exports = function(pjPath, options, rawConfig) {
	var env = String(options.env).toLowerCase();
	// 检查env合法性
	if (['test', 'pre', 'prod'].indexOf(env) === -1) {
		errorExit('Environment must be "test", pre" or "prod".');
	}

	// 存放解析后的构建配置
	var actualConfig = {
		env: env,
		build_from: {
			server: pjPath,
			// 解析出静态资源本地路径
			static: path.resolve(pjPath, rawConfig.static_path)
		}
	};

	var buildTo = actualConfig.build_to = { };
	// 解析发布路径，resolve后路径中还包含{$rev}，不是最终路径
	buildTo.server = path.resolve(pjPath, rawConfig.build_to.server);
	buildTo.static = path.resolve(pjPath, rawConfig.build_to.static);

	// 版本号
	var rev = String(options.rev || '').toLowerCase();
	// 没有指定版本号的时候自动生成，规则是“年月日-发布次数”
	if (!rev) {
		var date = new Date();
		date = date.getFullYear() +
			( '0' + (date.getMonth() + 1) ).slice(-2) +
			( '0' + date.getDate() ).slice(-2);

		var i = 1;
		do {
			if (i > 10000) {
				errorExist('No available revision directory.');
				break;
			}
			rev = date + '-' + (i++);
		} while (
			fs.existsSync( util.parseVars(buildTo.server, { rev: rev, env: env }) ) ||
			fs.existsSync( util.parseVars(buildTo.static, { rev: rev, env: env }) )
		);
	}
	// 解析出发布路径
	buildTo.server = util.parseVars(buildTo.server, { rev: rev, env: env });
	buildTo.static = util.parseVars(buildTo.static, { rev: rev, env: env });

	// 记录版本号，用于生成静态资源URL
	actualConfig.rev = rev;

	// 解析合并规则
	var ruleMap = { };
	actualConfig.combine = rawConfig.combine.map(function(rule) {
		var list = [ ];
		rule.list.forEach(function(item) {
			list.push(item);
			var embedRule = ruleMap[item];
			if (embedRule) {
				list.push.call(list, embedRule.list);
			}
		});
		ruleMap[rule.match] = {
			match: rule.match,
			list: list
		};
		return ruleMap[rule.match];
	});

	// 选用对应环境的静态域名
	actualConfig.static_hosts = rawConfig.static_hosts[env];

	// 静态资源URL前缀、单独文件规则无须解析
	actualConfig.static_url_prefix = rawConfig.static_url_prefix;
	actualConfig.standalone = rawConfig.standalone;

	// 记录起来，以便在gulpfile.js中调用
	global.buildingConfig = actualConfig;

	// 移除掉影响Gulp的参数
	process.argv = process.argv.slice(0, 2);

	// 通过参数指定调用本工具的gulpfile.js，而非工作目录下的
	process.argv.push( '--gulpfile', path.resolve(__dirname, './gulpfile.js') );
	// 调用gulp命令的入口文件开始构建
	require('gulp/bin/gulp');
};