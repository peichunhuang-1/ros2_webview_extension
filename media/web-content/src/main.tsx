import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import LayoutEditor from './components/layout-editor/LayoutEditor.tsx'
import GraphEditor from './components/graph-editor/GraphEditor.tsx'

const root = document.getElementById('root')!

function rootView() {
  switch (root.dataset.view) {
    case 'layout-editor': return <LayoutEditor />
    case 'graph-editor':  return <GraphEditor />
    default:              return <App />
  }
}

createRoot(root).render(
  <StrictMode>
    {rootView()}
  </StrictMode>,
)
