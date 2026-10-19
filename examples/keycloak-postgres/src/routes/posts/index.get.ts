import { route, t } from 'pangol'
import { Post } from '../../models.js'
import { posts } from '../../db.js'
export default route({ auth: 'user', response: t.array(Post.public()), handler: c => posts.list(c.user.id) })
