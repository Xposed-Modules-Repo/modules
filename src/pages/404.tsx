import * as React from 'react'
import { ReactElement } from 'react'
import Layout from '../layout'
import SEO from '../components/seo'
import _404 from '../components/404'

export default function NotFoundPage (): ReactElement {
  return (
    <Layout>
      <_404 />
    </Layout>
  )
}

export const Head = () => <SEO title="Not Found" />
