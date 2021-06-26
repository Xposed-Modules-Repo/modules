/**
 * Implement Gatsby's SSR (Server Side Rendering) APIs in this file.
 *
 * See: https://www.gatsbyjs.org/docs/ssr-apis/
 */

// eslint-disable-next-line no-unused-vars
const React = require('react')

export const onPreRenderHTML = ({
  getHeadComponents,
  replaceHeadComponents
}) => {
  const headComponents = getHeadComponents()
  headComponents.push(
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/RikkaW/webfonts@4/css/Roboto-VF.css" />
  )
  headComponents.push(
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/RikkaW/webfonts@4/css/NotoSansCJK-SC-VF.css" />
  )
  headComponents.push(
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/RikkaW/webfonts@4/css/NotoSansCJK-TC-VF.css" />
  )
  headComponents.push(
    <link rel='stylesheet' href='https://fonts.googleapis.com/icon?family=Material+Icons' media="print" onLoad="this.media='all'" />
  )
  headComponents.push(
    <meta name="google-site-verification" content="No7OKPupiyITd5MI15QlaU1_u9raHcajSn8ffTPUGNI" />
  )
  replaceHeadComponents(headComponents)
}
