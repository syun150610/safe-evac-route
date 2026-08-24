import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { SearchOptions } from './SearchOptions'

describe('SearchOptions', () => {
  it('API由来の条件を取得中であることを文言と動きで示す', () => {
    const html = renderToStaticMarkup(
      <SearchOptions loading summary="検索条件を読み込み中…" title="検索の条件">
        <span>条件</span>
      </SearchOptions>,
    )

    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('検索条件を読み込み中…')
    expect(html).toContain('animate-spin')
  })
})
