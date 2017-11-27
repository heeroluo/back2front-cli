/*!
 * Command line interface tools for Back2Front
 * 构建
 */

'use strict';

const path = require('path');
const fs = require('fs');
const childProcess = require('child_process');
const util = require('./lib/util');
const errorExit = util.errorExit;


// node bin/index build /Users/HeeroLaw/Projects/back2front --env test --rev 20161217
// back2front build /Users/HeeroLaw/Projects/back2front --env test --rev 20161217
module.exports = function(pjPath, options, rawConfig) {
	const env = String(options.env).toLowerCase();
	// 检查env合法性
	if (['dev', 'test', 'pre', 'prod'].indexOf(env) === -1) {
		errorExit('Environment must be "dev", "test", pre" or "prod".');
	}

	// 存放解析后的构建配置
	const actualConfig = {
		env: env,
		build_from: {
			server: pjPath,
			// 解析出静态资源本地路径
			static: path.resolve(pjPath, rawConfig.static_path)
		}
	};

	const buildTo = actualConfig.build_to = { };
	// 解析发布路径，resolve后路径中还包含{$rev}，不是最终路径
	buildTo.server = path.resolve(pjPath, rawConfig.build_to.server);
	buildTo.static = path.resolve(pjPath, rawConfig.build_to.static);

	// 版本号
	let rev = String(options.rev || '').toLowerCase();
	// 没有指定版本号的时候自动生成，规则是“年月日-时分秒-发布次数”
	if (!rev) {
		let date = util.formatDate(new Date(), 'YYYYMMDD-hhmmss');
		let i = 1;
		rev = date;

		while (fs.existsSync(
			util.parseVars(buildTo.server, { rev: rev, env: env })
		)) {
			if (i > 100) {
				errorExit('No available revision directory.');
				break;
			}
			rev = date + '-' + (i++);
		}
	}
	// 解析出发布路径
	buildTo.server = util.parseVars(buildTo.server, { rev: rev, env: env });
	buildTo.static = util.parseVars(buildTo.static, { rev: rev, env: env });

	// 记录版本号，用于生成静态资源URL
	actualConfig.rev = rev;

	// 解析合并规则
	const ruleMap = { };
	actualConfig.combine = (rawConfig.combine || [ ]).map((rule) => {
		var list = [ ];
		rule.list.forEach((item) => {
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
	if (rawConfig.static_hosts) {
		actualConfig.static_hosts = rawConfig.static_hosts[env];
	}

	// 静态资源URL前缀、单独文件规则无须解析
	actualConfig.static_url_prefix = rawConfig.static_url_prefix;
	actualConfig.standalone = (rawConfig.standalone || []).slice();

	// 以子进程方式调用Gulp
	childProcess.fork(require.resolve('gulp/bin/gulp'), [
		'--gulpfile',
		path.resolve(__dirname, './gulpfile.js'),
		'--config',
		JSON.stringify(actualConfig)
	], {
		cwd: __dirname
	});
};