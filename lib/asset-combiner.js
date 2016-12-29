/*!
 * Command line tools for Back2Front
 * 资源合并
 */

'use strict';

var path = require('path'),
	fs = require('fs'),
	minimatch = require('minimatch'),
	util = require('./util');


// 带缓存的文件合并
var fileCombiner = {
	_cache: { },
	combine: function(basePath, filePaths, fileType, savePath) {
		var key = '[' + basePath + ']' + filePaths.join(','),
			cache = this._cache;

		if (cache[key]) { return cache[key]; }

		// 合并文件内容，以换行分隔
		var fileContent = filePaths.map(function(filePath) {
			return util.readFile(
				path.join( basePath, util.convertExtname(filePath) ), true
			);
		}).join('\n');

		// 通过MD5得出文件名
		var filePath = path.join(
			savePath,
			util.convertExtname(
				util.calcMd5(fileContent, 16) + '.' + fileType
			)
		);
		fs.writeFileSync(filePath, fileContent, 'utf8');

		cache[key] = util.normalizeSlash( path.relative(basePath, filePath) );

		return cache[key];
	}
};


/**
 * 外部调用入口
 * @param {Object} depaMap 资源依赖表
 * @param {Array} combineRules 合并规则
 * @param {Array} staGlobs 独立文件规则
 * @param {String} basePath 资源根路径
 * @return {Object} 合并后的资源依赖表
 */
exports.combine = function(depaMap, combineRules, staGlobs, basePath) {
	// 创建存放合并文件的目录
	var savePath = path.join(basePath, '~combines');
	if ( !fs.existsSync(savePath) ) {
		fs.mkdirSync(savePath);
	}

	// 存放合并后的资源依赖表
	var allResult = { };

	Object.keys(depaMap).forEach(function(tplRelPath) {
		var tplDeps = depaMap[tplRelPath];
		allResult[tplRelPath] = { };

		['headjs', 'css', 'js', 'modjs'].forEach(function(depType) {
			var deps = tplDeps[depType].slice();
			if (!deps || !deps.length) { return; }

			var result = [ ], i = 0;

			// 先抽出不能合并的文件
			staGlobs = staGlobs || [ ];
			while (i < deps.length) {
				if ( util.isURL(deps[i]) || staGlobs.some(function(glob) {
					return minimatch(deps[i], glob);
				}) ) {
					result.push(deps.splice(i, 1)[0]);
				} else {
					// 包装一下，便于后续的处理
					deps[i] = { path: deps[i] };
					i++;
				}
			}

			var primary,
				secondary,
				currentGlobs,
				canMatch,
				combines,
				j,
				counter = 0;

			for (i = 0; i < deps.length && counter < deps.length; i++) {
				// 当前资源
				primary = deps[i];

				// 循环所有规则，判断当前资源能否成为合并方
				canMatch = !primary.combined && combineRules.some(function(rule) {
					if ( minimatch(primary.path, rule.match) ) {
						currentGlobs = rule.list;
						return true;
					}
				});
				if (!canMatch) { continue; }

				combines = [ ];
				// 循环找出符合条件的被合并方
				for (j = 0; j < deps.length; j++) {
					secondary = deps[j];
					// 自己不能合并自己，已经被合并的也不能再被合并
					if (i === j || secondary.combined) {
						continue;
					}
					currentGlobs.some(function(glob) {
						if ( minimatch(secondary.path, glob) ) {
							combines.push(secondary.path);
							secondary.combined = true;
							counter++;
						}
					});
				}

				// 如果存在被合并方，则合并生效，否则无效
				if (combines.length) {
					combines.unshift(primary.path);
					primary.combined = true;
					counter++;
					result.push(combines);
				}
			}

			var rests = counter === deps.length
				? [ ]
				: deps.filter(function(dep) { return !dep.combined; });

			// 合并剩余的文件
			if (rests.length === 1) {
				result.push(rests[0].path);
			} else if (rests.length > 1) {
				result.push(
					rests.map(function(dep) { return dep.path; })
				);
			}

			// 循环执行合并
			result = result.map(function(assetPaths) {
				if ( Array.isArray(assetPaths) ) {
					return fileCombiner.combine(basePath, assetPaths, depType, savePath);
				} else {
					// 不用合并的资源，要转成最终的扩展名
					return util.convertExtname(assetPaths);
				}
			});

			// 记录到最终结果表中
			allResult[tplRelPath][depType] = result;
		});
	});

	return allResult;
};