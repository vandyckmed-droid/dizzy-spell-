import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppRegistry } from 'react-native-web';
import App from '../../app/App.js';
AppRegistry.registerComponent('App', () => App);
const root = createRoot(document.getElementById('root'));
root.render(React.createElement(App));
