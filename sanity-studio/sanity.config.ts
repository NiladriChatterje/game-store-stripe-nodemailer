import { defineConfig } from 'sanity'
import { structureTool } from 'sanity/structure'
import { visionTool } from '@sanity/vision'
import { schemaTypes } from './schemaTypes';
import {embeddingsIndexReferenceInput} from '@sanity/embeddings-index-ui'

export default defineConfig({
  name: 'default',
  title: 'xvstore',

  projectId: 's95gzq5b',
  dataset: 'production',

  plugins: [structureTool(), visionTool(),embeddingsIndexReferenceInput()],

  schema: {
    types: schemaTypes
  },
})
