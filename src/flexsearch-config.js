const { Segment, useDefault } = require('segmentit')

module.exports = {
  tokenize: function (str) {
    const segmentit = useDefault(new Segment())
    const result = segmentit.doSegment(str)
    return result.map((token) => token.w)
  }
}
