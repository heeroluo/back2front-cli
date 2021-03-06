/*!
 * Command line interface tools for Back2Front
 * 依赖分析
 */

'use strict';

const fs = require('fs');
const path = require('path');
const minimatch = require('minimatch');
const glob = require('glob');
const util = require('./lib/util');


module.exports = (pjPath, options, config) => {
	// 静态资源根路径
	const basePath = path.resolve(pjPath, config.static_path || config.build_from.static);

	// 获取资源相对于资源根目录的路径
	function getRelPath(assetPath, contextPath, assetType) {
		assetPath = assetPath.replace(/\?.*$/, '');
		// 如果以点开头，则相对上下文目录，否则相对资源根路径
		assetPath = /^\./.test(assetPath) ?
			path.resolve(path.dirname(contextPath), assetPath) :
			path.join(basePath, assetPath);

		if (!path.extname(assetPath)) {
			assetPath += '.';
			switch (assetType) {
				case 'headjs':
				case 'js':
					assetPath += 'raw.js';
					break;
		
				case 'modjs':
					assetPath += 'js';
					break;

				default:
					assetPath += assetType;
			}
		}

		return util.normalizeSlash(path.relative(basePath, assetPath));
	}

	// 解析资源路径
	function parsePath(p) {
		// mod@ver => mod/ver/mod
		return p.replace(
			/([^\\\/]+)@([^\\\/]+)/g,
			(match, module, version) => {
				return module + '/' + version + '/' + module;
			}
		);
	}

	// 合并两个对象中的同名数组
	function concatObj(target, src) {
		Object.keys(src).forEach((key) => {
			target[key] = target[key].concat(src[key]);
		});
	}

	// 数组去重复，主要用于去除重复的资源依赖
	function uniqueArray(arr) {
		return [...new Set(arr)];
	}


	// 资源依赖分析器
	const assetParsers = {
		// 不在JS里面依赖其他JS，故无需分析
		_headjs: {
			parse() { return [ ]; }
		},

		// 只分析单个CSS的直接依赖，并进行缓存
		_css: {
			_cache: { },
			parse(filePath, fileContent) {
				let result = this._cache[filePath];
				if (!result) {
					// 粗略移除代码中的注释
					fileContent = fileContent.replace(/^\s*\/\*[\s\S]*?\*\/\s*$/mg, '');

					result = [ ];
					// 只匹配 import url(...)
					let re = /@import\s+url\(["']*(.+?)["']*\)/;
					let match;
					while (match = re.exec(fileContent)) {
						result.push(match[1].trim());
					}

					this._cache[filePath] = result;
				}

				return result.slice();
			}
		},

		// 不在JS里面依赖其他JS，故无需分析
		_js: {
			parse() { return [ ]; }
		},

		// 只分析单个模块化JS的直接依赖，并进行缓存
		_modjs: {
			_cache: { },
			parse(filePath, fileContent) {
				let result = this._cache[filePath];

				if (!result) {
					// 粗略移除代码中的注释
					fileContent = fileContent
						.replace(/^\s*\/\*[\s\S]*?\*\/\s*$/mg, '')
						.replace(/^\s*\/\/.*$/mg, '');

					const re = /(?:^|[^.$])\b(?:require|_tpl)\s*\(\s*(["'])([^"'\s\)]+)\1\s*\)/g;
					let match;
					result = [ ];
					while (match = re.exec(fileContent)) {
						result.push(parsePath(match[2]));
					}

					this._cache[filePath] = result;
				}

				return result.slice();
			}
		},

		_cache: { },

		parse(fileRelPath, type, counter) {
			// 避免循环依赖导致无法完成依赖分析，限制最多60层依赖
			counter = counter || 0;
			if (counter > 60) {
				return;
			} else {
				counter++;
			}

			const t = this;
			const cache = t._cache;
			const filePath = path.join(basePath, fileRelPath);
	
			if (cache[filePath]) { return cache[filePath].slice(); }

			const fileContent = util.readFile(filePath);
			const parser = t['_' + type];

			let result = [ ];
			// 循环每一个依赖，递归获取依赖的依赖
			parser.parse(filePath, fileContent).forEach((dep) => {
				// 当前版本不处理外链资源
				if (util.isURL(dep)) { return; }

				dep = getRelPath(dep, filePath, type);
				// 自身
				result.push(dep);
				// 依赖
				result = result.concat(t.parse(dep, type, counter));
			});

			// 去重复
			result = uniqueArray(result);

			cache[filePath] = result;

			return result.slice();
		}
	};


	// 分析模板依赖的资源
	const tplParser = {
		_cache: { },

		parse(fileRelPath) {
			const cache = this._cache;
			if (cache[fileRelPath]) { return cache[fileRelPath]; }

			const filePath = path.join(basePath, fileRelPath);
			let fileContent = util.readFile(filePath);
			const result = {
				tpl: [ ],
				headjs: [ ],
				css: [ ],
				js: [ ],
				modjs: [ ]
			};
			const reAssetList = /\{{2,3}#?\s*(headjs|css|js|modjs)\s*\(([\W\w]*?)\)/g;
			const reAssetItem = /(["'])(.+?)\1/g;

			// 分析静态资源依赖
			fileContent = fileContent.replace(reAssetList, (match, assetType, assetItems) => {
				let subMatch;
				let subResult;
				let assetPath;
				const replacement = [];

				while (subMatch = reAssetItem.exec(assetItems)) {
					assetPath = subMatch[2];
					// 不处理外链资源
					if (util.isURL(assetPath)) { continue; }

					assetPath = getRelPath(parsePath(assetPath), filePath, assetType);

					subResult = assetParsers.parse(assetPath, assetType);

					// 分离JS中引用的模板
					if (assetType === 'modjs') {
						subResult = subResult.filter((item) => {
							if (/\.xtpl$/i.test(item)) {
								replacement.push(
									'{{ include(' + JSON.stringify(item + '?csrOnly') + ') }}'
								);
								return false;
							} else {
								return true;
							}
						});
					}

					// 自身
					result[assetType].push(assetPath);
					// 依赖
					result[assetType] = result[assetType].concat(subResult);
				}

				replacement.push(match);

				return replacement.join('\n');
			});

			// 添加模板依赖
			const addTplDep = (depTpl, filePath, isCSR) => {
				depTpl = getRelPath(depTpl, filePath, 'xtpl');

				// 递归调用获取所有依赖
				const depResult = this.parse(depTpl);
				// 自身
				result.tpl.push(depTpl);
				// 依赖
				concatObj(result, depResult);

				// 需要在浏览器端渲染的模板
				if (isCSR) {
					depResult.tpl.forEach((tpl) => {
						result.modjs.push(tpl + '.js');
					});
					result.modjs.push(depTpl + '.js');
				}
			};

			// 分析模板依赖
			const reDepTpl = /\{{2,3}\s*(?:extend|parse|include|includeOnce)\s*\(\s*(['"])(.+?)\1/g;

			let isCSR;
			let match;
			while (match = reDepTpl.exec(fileContent)) {
				isCSR = false;
				addTplDep(
					match[2].replace(/\?(.*)$/, (match, query) => {
						isCSR = /^csr(?:Only)?$/.test(query);
						return '';
					}),
					filePath,
					isCSR
				);
			}

			Object.keys(result).forEach((key) => {
				result[key] = uniqueArray(result[key]);
			});

			cache[fileRelPath] = result;

			return result;
		}
	};


	return new Promise((resolve, reject) => {
		glob('**/*.page.xtpl', {
			cwd: basePath
		}, (err, files) => {
			if (err) {
				reject(err);
			} else {
				const allResult = { };
				files.forEach((fileRelPath) => {
					allResult[fileRelPath] = tplParser.parse(fileRelPath);
				});
				resolve(allResult);
			}
		});
	});
};