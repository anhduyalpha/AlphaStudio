import React from 'react';
import ModularWorkspaceView from './ModularWorkspaceView';
import { textConfig } from './extraToolConfigs';

export default function TextView({ notify }) {
  return <ModularWorkspaceView config={textConfig} notify={notify} />;
}
