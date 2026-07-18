import React from 'react';
import ModularWorkspaceView from './ModularWorkspaceView';
import { colorConfig } from './extraToolConfigs';

export default function ColorView({ notify }) {
  return <ModularWorkspaceView config={colorConfig} notify={notify} />;
}
