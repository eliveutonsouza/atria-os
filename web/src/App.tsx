import { Fragment } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router'
import { Login } from './shell/Login'
import { Shell } from './shell/Shell'
import { useAssistantName } from './lib/assistant'

// Trocar o nome do assistente remonta a árvore inteira: textos fixos e rótulos passam a usar o nome novo.
export function App() {
  const name = useAssistantName()
  return (
    <Fragment key={name}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<Shell />} />
        </Routes>
      </BrowserRouter>
    </Fragment>
  )
}
