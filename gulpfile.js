/*!
 * Command line interface tools for Back2Front
 * 基于Gulp的构建流程
 */

'use strict';

const path = require('path');
const fs = require('fs');
const pump = require('pump');
const gulp = require('gulp');
const gulpFilter = require('gulp-filter');
const gulpMD5 = require('./lib/gulp-md5-export');
const gulpLEC = require('gulp-line-ending-corrector');
const gulpModify = require('gulp-modify');
const postcssrc = require('postcss-load-config');
const gulpPostCSS = require('gulp-postcss');
const gulpCleanCSS = require('gulp-clean-css');
const gulpUglify = require('gulp-uglify');
const jsonFormat = require('json-format');
const babel = require('babel-core');
const util = require('./lib/util');
const depa = require('./depa');
const combiner = require('./lib/asset-combiner');
const argvs = require('minimist')(process.argv.slice(2));
const config = JSON.parse(argvs.config);


// 返回文件匹配规则
function srcGlobs(type, rule) {
	return path.resolve(config.build_from[type], rule);
}

// 返回目标目录
function gulpDest(type, subPath) {
	let destPath = config.build_to[type];
	if (subPath) {
		destPath = path.join(destPath, subPath);
	}
	return gulp.dest(destPath);
}

// 匹配纯文本文件的过滤器
function createPlainTextFilter() {
	return gulpFilter(function(file) {
		return [
			'html',
			'css',
			'scss',
			'js',
			'json',
			'txt',
			'md',
			'log',
			''
		].indexOf(
			path.extname(file.path).toLowerCase()
		) !== -1;
	}, {
		restore: true
	});
}

// 转换为资源引用路径（相对路径）
function toAssetPath(file) {
	return JSON.stringify(
		util.normalizeSlash(
			path.relative(file.base, file.path)
		)
	);
}

// 解析出可用的静态资源路径
//   使用第一、二个路径交替引用CSS、JS资源
//   使用第三个路径在CSS文件中引用资源
//   使用第三个路径在页面中引用资源
//   使用第三个路径作为JS加载器基路径
const urlPrefixes = (config.static_hosts || ['']).map(function(host) {
	let result = util.parseVars(config.static_url_prefix, {
		host: host,
		rev: config.rev
	});
	if (result[result.length - 1] !== '/') { result += '/'; }
	return result;
});
// 补够3个路径
while (urlPrefixes.length < 3) {
	urlPrefixes.push(urlPrefixes[urlPrefixes.length - 1]);
}


// 资源依赖表
let depaMap;
const md5Map = { }; // 资源文件的MD5映射
let assetMap; // 合并文件后的资源依赖表
const postCSSConfig = { }; // PostCSS配置


// 分析页面资源依赖
gulp.task('depa', (callback) => {
	depa(config.pjPath, null, config).then((result) => {
		depaMap = result;
		callback();
	});
});


// 非代码文件加MD5戳
gulp.task('md5-others', (cb) => {
	var plainTextFilter = createPlainTextFilter();
	pump([
		gulp.src([
			srcGlobs('static', '**/*'),
			'!' + srcGlobs('static', '**/*.js'),
			'!' + srcGlobs('static', '**/*.scss'),
			'!' + srcGlobs('static', '**/*.css'),
			'!' + srcGlobs('static', '**/*.xtpl')
		]),
		plainTextFilter,
		gulpLEC(),
		plainTextFilter.restore,
		gulpMD5({
			exportMap(src, md5) {
				md5Map[src] = md5;
			}
		}),
		gulpDest('static')
	], cb);
});


// 加载PostCSS配置
gulp.task('load-postcss-config', (callback) => {
	postcssrc(null, config.build_from.server, {
		argv: ''
	}).then(({ plugins, options }) => {
		postCSSConfig.plugins = plugins;
		postCSSConfig.options = options;
		callback();
	}, (e) => {
		callback();
	});
});


// CSS构建
gulp.task('build-styles', ['load-postcss-config', 'md5-others'], (cb) => {
	// 把CSS文件中的相对路径转换为绝对路径
	const inCSSURLPrefix = urlPrefixes[2];

	// 匹配*.scss
	const scssFilter = gulpFilter((file) => {
		return /\.scss$/i.test(file.path);
	}, {
		restore: true
	});

	function cssRel2Root(file, fn) {
		return (match, quot, origPath) => {
			if (util.isURL(origPath) || util.isBase64(origPath)) {
				// 不对URL或Base64编码做处理
				return match;
			} else {
				// 计算出相对项目根目录的路径
				let relPath = util.normalizeSlash(
					path.relative(
						file.base,
						path.resolve(path.dirname(file.path), origPath)
					)
				);

				return fn(quot + inCSSURLPrefix + md5Map[relPath] + quot);
			}
		};
	}

	pump([
		gulp.src([
			srcGlobs('static', '**/*.css'),
			srcGlobs('static', '**/*.scss')
		]),
		scssFilter,
		gulpModify({
			// 替换注释符
            fileModifier(file, content) {
				return content.replace(/^\s*\/{2}(.*)$/mg, (match, comment) => {
					return '/*' + comment.replace(
						/\//g, '\\/'
					) + '*/';
				});
			}
		}),
		gulpPostCSS(postCSSConfig.plugins),
		scssFilter.restore,
		gulpModify({
			// 相对路径转成绝对路径
            fileModifier(file, content) {
				return content
					// 移除CSS的import语句，因为分析依赖的时候已经把import的文件提取出来
					.replace(/^\s*@import\s+.*$/m, '')
					// 替换 url(...) 中的路径
					.replace(
						/\burl\((['"]?)(.+?)\1\)/g,
						cssRel2Root(file, (result) => {
							return 'url(' + result + ')';
						})
					);
			}
		}),
		gulpCleanCSS({
			compatibility: 'ie8',
			aggressiveMerging: false
		}),
		gulpModify({
            fileModifier(file, content) {
				let assetPath = toAssetPath(file);
				let result = 'cssFiles[' + assetPath + ']=' + JSON.stringify(content) + ';';
				file.path = util.convertExtname(file.path);
				return result;
			}
		}),
		gulpMD5({
			exportMap: function(src, md5) {
				md5Map[util.revertExtname(src)] = md5;
			}
		}),
		gulpDest('static')
	], cb);
});


// 构建模板（转成模块化js）
gulp.task('build-tpl', (cb) => {
	pump([
		gulp.src([
			srcGlobs('static', '**/*.xtpl'),
			'!' + srcGlobs('static', '**/*.page.xtpl'),
		]),
		gulpLEC(),
		gulpModify({
			fileModifier(file, content) {
				let moduleId = util.normalizeSlash(
					path.relative(file.base, file.path)
				);
				file.path = util.convertExtname(file.path);
				return 'define(' +
					JSON.stringify(moduleId) +
					',' +
					'null,' +
					'function(r, e, m) {' +
						'm.exports=' + JSON.stringify(content) +
					'}' +
				');';
			}
		}),
		gulpMD5({
			exportMap(src, md5) {
				md5Map[util.revertExtname(src)] = md5;
			}
		}),
		gulpDest('static')
	], cb);
});


// 构建普通js和模块化js
gulp.task('build-js', (cb) => {
	// 匹配普通JS
	const jsFilter = gulpFilter((file) => {
		return /\.raw\.js$/i.test(file.path) && !/\.preload\.raw\.js$/i.test(file.path);
	}, {
		restore: true
	});
	// 匹配模块化JS
	const modjsFilter = gulpFilter((file) => {
		return path.extname(file.path).toLowerCase() === '.js' &&
			!/\.raw\.js$/i.test(file.path);
	}, {
		restore: true
	});

	pump([
		gulp.src(srcGlobs('static', '**/*.js')),
		jsFilter,
		gulpModify({
            fileModifier(file, content) {
				return 'jsFiles[' + toAssetPath(file) + ']=' +
					'function(window) {' + content + '};';
			}
		}),
		jsFilter.restore,
		modjsFilter,
		gulpModify({
            fileModifier(file, content) {
				let code;
				try {
					code = babel.transform(
						content.replace(/\b_tpl\s*\(\s*((['"]).+?\1)\s*\)/g, 'require.resolve($1)'),
						{
							presets: [
								['env', { modules: false }],
								'stage-2'
							]
						}
					).code
				} catch (e) {
					e.fileName = file.path;
					throw e;
				}
				return 'define(' +
					toAssetPath(file) + ',' +
					'null,' +
					'function(require, exports, module) { "use strict";' +
						code +
					'}' +
				');';
			}
		}),
		modjsFilter.restore,
		gulpUglify({ ie8: true }),
		gulpMD5({
			exportMap(src, md5) {
				md5Map[src] = md5;
			}
		}),
		gulpDest('static')
	], cb);
});


// 复制其余文件到目标目录
gulp.task('copy-others', () => {
	const plainTextFilter = createPlainTextFilter();
	return gulp
		.src([
			srcGlobs('server', '**/*'),
			'!' + srcGlobs('static', '**/*'), // 资源文件的复制放到copy-assets中完成
			'!' + srcGlobs('server', 'node_modules/**'),
			'!' + srcGlobs('server', '**/*.defined.js'),
			'!' + srcGlobs('server', '**/*.xtpl.js'),
			'!' + srcGlobs('server', '**/*.log')
		])
		.pipe(plainTextFilter)
		.pipe(gulpLEC())
		.pipe(plainTextFilter.restore)
		.pipe(gulpDest('server'));
});

// 复制资源文件到目标目录
// Express端只可能用到模板或者js
gulp.task('copy-assets', () => {
	return gulp
		.src([
			srcGlobs('static', '**/*.xtpl'),
			srcGlobs('static', '**/*.js')
		])
		.pipe(gulpLEC())
		.pipe(
			gulpDest('server', path.relative(
				config.build_from.server, config.build_from.static
			))
		);
});


// 资源合并，并输出合并后的资源依赖表
gulp.task('combine-assets', [
	'depa',
	'build-styles',
	'build-tpl',
	'build-js'
], (callback) => {
	assetMap = combiner.combine(
		depaMap,
		md5Map,
		config.combine,
		config.standalone,
		config.build_to.static
	);
	callback();
});


gulp.task('default', [
	'combine-assets',
	'copy-others',
	'copy-assets'
], () => {
	// 服务器端用的MD5映射表
	fs.writeFileSync(
		path.join(config.build_to.server, 'md5-map.json'),
		jsonFormat(md5Map),
		'utf8'
	);

	// 浏览器端用的MD5映射表，要进行瘦身
	let md5MapForBrowser = { };

	let md5MapKeys = Object.keys(md5Map);
	// 先排序，避免由于顺序不同导致文件内容不一致
	md5MapKeys.sort();

	md5MapKeys.forEach((key) => {
		// 模板文件、样式文件、模块化脚本文件不会动态载入，可以移除
		if (!/\.(xtpl|css|js)$/i.test(key) || /\.raw\.js$/.test(key)) {
			// 仅保留MD5的部分而不是完整的路径
			md5MapForBrowser[key] = md5Map[key].split('.').splice(-2, 1)[0];
		}
	});

	// 创建存放MD5映射表的文件夹
	let md5Dirname = path.join(config.build_to.static, 'md5-map');
	if (!fs.existsSync(md5Dirname)) {
		fs.mkdirSync(md5Dirname);
	}

	md5MapForBrowser = 'var md5Map = ' + JSON.stringify(md5MapForBrowser) + ';';
	let md5MapForBrowserFileName = 'md5-map.' + util.calcMd5(md5MapForBrowser, 10) + '.js';
	// 浏览器端用的MD5映射表
	fs.writeFileSync(
		path.join(md5Dirname, md5MapForBrowserFileName),
		md5MapForBrowser,
		'utf8'
	);

	Object.keys(assetMap).forEach((tplRelPath) => {
		let tplAssets = assetMap[tplRelPath];
		['headjs', 'css', 'modjs', 'js'].forEach((assetType, i) => {
			// 增加映射表资源引用
			if (assetType === 'headjs') {
				tplAssets[assetType] = tplAssets[assetType] || [];
				tplAssets[assetType].unshift('md5-map/' + md5MapForBrowserFileName);
			}

			if (!tplAssets[assetType]) { return; }

			tplAssets[assetType] = tplAssets[assetType].map((p) => {
				if (!util.isURL(p)) {
					// 交替使用不同的URL前缀
					p = urlPrefixes[i % 2] + p;
				}
				return p;
			});
		});
	});

	// 保存最终的资源引用表
	fs.writeFileSync(
		path.join(config.build_to.server, 'asset-config.json'),
		jsonFormat({
			url_prefix: urlPrefixes[2],
			map: assetMap
		}),
		'utf8'
	);
});