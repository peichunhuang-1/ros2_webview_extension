import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import LayoutEditor from './components/LayoutEditor.tsx'

const root = document.getElementById('root')!

createRoot(root).render(
  <StrictMode>
    {root.dataset.view === 'layout-editor' ? <LayoutEditor /> : <App />}
  </StrictMode>,
)
