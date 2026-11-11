/** 浏览器唯一的宿主依赖入口；保留 require 对象的命名属性语义。 */
import * as React from 'react';
import * as ReactDOM from 'react-dom';

const h = React.createElement;
const Fragment = React.Fragment;

export { React, ReactDOM, h, Fragment };
