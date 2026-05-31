import { Router, Request, Response } from 'express';
import { authMiddleware } from './middleware';
import { generateToken, hashPassword, validatePassword } from '../lib/auth';
import { UserRepository, PostRepository, CommentRepository } from '../db/models';

const router = Router();
const userRepo = new UserRepository();
const postRepo = new PostRepository();
const commentRepo = new CommentRepository();

// Auth Routes
router.post('/auth/register', async (req: Request, res: Response) => {
  const { email, password, name } = req.body;
  const hashed = hashPassword(password);
  const user = await userRepo.create({ email, password: hashed, name });
  const token = generateToken(user.id, user.email);
  res.json({ token, user });
});

router.post('/auth/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  const user = await userRepo.findByEmail(email);
  if (!user || !validatePassword(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = generateToken(user.id, user.email);
  res.json({ token, user });
});

// User Routes
router.get('/users/:id', authMiddleware, async (req: Request, res: Response) => {
  const user = await userRepo.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

router.put('/users/:id', authMiddleware, async (req: Request, res: Response) => {
  const user = await userRepo.update(req.params.id, req.body);
  res.json(user);
});

// Post Routes
router.get('/posts', async (req: Request, res: Response) => {
  // Simplified - would normally paginate
  res.json([]);
});

router.post('/posts', authMiddleware, async (req: Request, res: Response) => {
  const { title, content } = req.body;
  const post = await postRepo.create({
    title,
    content,
    authorId: (req as any).user.userId,
  });
  res.json(post);
});

router.get('/posts/:id', async (req: Request, res: Response) => {
  const post = await postRepo.findById(req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  res.json(post);
});

// Comment Routes
router.get('/posts/:postId/comments', async (req: Request, res: Response) => {
  const comments = await commentRepo.findByPost(req.params.postId);
  res.json(comments);
});

router.post('/posts/:postId/comments', authMiddleware, async (req: Request, res: Response) => {
  const comment = await commentRepo.create({
    content: req.body.content,
    postId: req.params.postId,
    authorId: (req as any).user.userId,
  });
  res.json(comment);
});

export default router;
