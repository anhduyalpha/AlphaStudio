import React from 'react';
import ModularWorkspaceView from './ModularWorkspaceView';
import { securityConfig } from './extraToolConfigs';

export default function SecurityView({ notify }) {
  return <ModularWorkspaceView config={securityConfig} notify={notify} />;
}
