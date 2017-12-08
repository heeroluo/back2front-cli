/*!
 * Command line interface tools for Back2Front
 * 资源合并
 */

'use strict';

const path = require('path');
const fs = require('fs');
const minimatch = require('minimatch');
const util = require('./util');


// 带缓存的文件合并
const fileCombiner = {
	_cache: { },

	combine(basePath, filePaths, fileType, savePath) {
		const key = '[' + basePath + ']' + filePaths.join(',');
		const cache = this._cache;

		if (cache[key]) { return cache[key]; }

		// 合并文件内容，以换行分隔
		let fileContent = filePaths.map((filePath) => {
			return util.readFile(
				path.join(basePath, filePath),
				true
			);
		}).join('\n');

		// 通过MD5得出文件名
		let filePath = path.join(
			savePath,
			util.convertExtname(util.calcMd5(fileContent, 16), fileType)
		);
		fs.writeFileSync(filePath, fileContent, 'utf8');

		cache[key] = util.normalizeSlash(path.relative(basePath, filePath));

		return cache[key];
	}
};


/**
 * 外部调用入口
 * @param {Object} depaMap 资源依赖表
 * @param {Object} md5Map 资源MD5映射表
 * @param {Array} combineRules 合并规则
 * @param {Array} staGlobs 独立文件规则
 * @param {String} basePath 资源根路径
 * @return {Object} 合并后的资源依赖表
 */
exports.combine = function(depaMap, md5Map, combineRules, staGlobs, basePath) {
	// 创建存放合并文件的目录
	const savePath = path.join(basePath, '~combines');
	if (!fs.existsSync(savePath)) {
		fs.mkdirSync(savePath);
	}

	// 存放合并后的资源依赖表
	const allResult = { };

	Object.keys(depaMap).forEach((tplRelPath) => {
		const tplDeps = depaMap[tplRelPath];
		allResult[tplRelPath] = { };
		staGlobs = staGlobs || [ ];

		['headjs', 'css', 'js', 'modjs'].forEach((depType) => {
			let deps = tplDeps[depType].slice();
			if (!deps || !deps.length) { return; }

			let result = [ ];
			let i = 0;

			// 先抽出不能合并的文件
			while (i < deps.length) {
				if (util.isURL(deps[i]) || staGlobs.some((glob) => {
					return minimatch(deps[i], glob);
				})) {
					// 不能合并的文件（外站文件，以及规则中指定不合并的文件）
					result.push(deps.splice(i, 1)[0]);
				} else {
					// 包装一下，便于后续的处理
					deps[i] = { path: deps[i] };
					i++;
				}
			}

			let primary;
			let secondary;
			let currentGlobs;
			let canMatch;
			let combines;
			let counter = 0;

			for (i = 0; i < deps.length && counter < deps.length; i++) {
				// 当前资源
				primary = deps[i];

				// 循环所有规则，判断当前资源能否成为合并方
				canMatch = !primary.combined && combineRules.some((rule) => {
					if (minimatch(primary.path, rule.match)) {
						currentGlobs = rule.list;
						return true;
					}
				});
				if (!canMatch) { continue; }

				combines = [ ];
				// 循环找出符合条件的被合并方
				for (let j = 0; j < deps.length; j++) {
					secondary = deps[j];
					// 自己不能合并自己，已经被合并的也不能再被合并
					if (i === j || secondary.combined) {
						continue;
					}
					currentGlobs.some((glob) => {
						if (minimatch(secondary.path, glob)) {
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

			let rests = counter === deps.length ?
				[ ] :
				deps.filter((dep) => { return !dep.combined; });

			// 合并剩余的文件
			if (rests.length === 1) {
				result.push(rests[0].path);
			} else if (rests.length > 1) {
				result.push(
					rests.map((dep) => { return dep.path; })
				);
			}

			// 循环执行合并
			result = result.map((assetPaths) => {
				if (Array.isArray(assetPaths)) {
					return fileCombiner.combine(
						basePath,
						assetPaths.map((p) => {
							return md5Map[util.revertExtname(p)];
						}),
						depType,
						savePath
					);
				} else {
					// 不用合并的资源，返回MD5后的路径
					return md5Map[assetPaths];
				}
			});

			// 记录到最终结果表中
			allResult[tplRelPath][depType] = result;
		});
	});

	return allResult;
};