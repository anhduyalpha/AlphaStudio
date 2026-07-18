import React from 'react';
import ModularWorkspaceView from './ModularWorkspaceView';
import { audioConfig } from './extraToolConfigs';

export default function AudioView({ notify }) {
  return <ModularWorkspaceView config={audioConfig} notify={notify} />;
}
