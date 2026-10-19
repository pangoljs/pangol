// A helper, not a route: files starting with _ are skipped.
import { posts } from '../../models.js'

export const loadPost = (id: string) => posts.get(id) ?? null
