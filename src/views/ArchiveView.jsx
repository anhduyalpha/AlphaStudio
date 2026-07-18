import React from 'react';
import ModularWorkspaceView from './ModularWorkspaceView';
import { archiveConfig } from './extraToolConfigs';

export default function ArchiveView({ notify }) {
  return <ModularWorkspaceView config={archiveConfig} notify={notify} />;
}
