import { useEffect, useState } from 'react'
import type { Account } from '../lib/auth'
import { relativeDays } from '../lib/format'
import { addComment, fetchComments, type Comment } from '../lib/submissions'

interface Props {
  bathroomId: string
  account: Account | null
}

export default function Comments({ bathroomId, account }: Props) {
  const [comments, setComments] = useState<Comment[]>([])
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    fetchComments(bathroomId)
      .then((c) => { if (live) setComments(c) })
      .catch(() => { if (live) setComments([]) })
    return () => { live = false }
  }, [bathroomId])

  const post = async () => {
    if (!account) return
    setBusy(true)
    setError(null)
    try {
      await addComment(bathroomId, account.id, body.trim())
      setBody('')
      setComments(await fetchComments(bathroomId))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't post that.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="comments">
      <h3 className="comments-title">
        Notes{comments.length > 0 && <span className="count">{comments.length}</span>}
      </h3>

      {comments.length === 0 && <p className="comments-empty">No notes yet.</p>}

      <ul className="comment-list">
        {comments.map((c) => (
          <li key={c.id}>
            <div className="comment-meta">
              <b>{c.author}</b>
              <time dateTime={c.created_at}>{relativeDays(c.created_at)}</time>
            </div>
            <p>{c.body}</p>
          </li>
        ))}
      </ul>

      {account ? (
        <div className="comment-form">
          <textarea
            rows={2}
            value={body}
            maxLength={1000}
            placeholder="Anything worth knowing before someone goes?"
            onChange={(e) => setBody(e.target.value)}
          />
          {error && <p className="report-error">{error}</p>}
          <button
            type="button"
            className="btn-primary"
            disabled={busy || body.trim().length === 0}
            onClick={() => void post()}
          >
            {busy ? 'Posting…' : 'Add a note'}
          </button>
        </div>
      ) : (
        <p className="comments-empty">Sign in to leave a note.</p>
      )}
    </section>
  )
}
