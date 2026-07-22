import React from 'react';
import { View } from 'react-native-web';
export const SafeAreaProvider=({children})=>React.createElement(View,{style:{flex:1}},children);
export const SafeAreaView=({children,style})=>React.createElement(View,{style},children);
export const useSafeAreaInsets=()=>({top:44,bottom:34,left:0,right:0});
export default {SafeAreaProvider,SafeAreaView,useSafeAreaInsets};
