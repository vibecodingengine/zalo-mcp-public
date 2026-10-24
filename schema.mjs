import {z} from 'zod';
const limit=z.number().int().min(1).max(100).default(50);
const before=z.object({sent_at:z.number().int().nonnegative(),seq:z.number().int().positive()}).strict().optional();
export const readSchemas={
  status:z.object({}).strict(),
  conversations:z.object({limit}).strict(),
  history:z.object({thread_id:z.string().min(1).max(128),limit,before}).strict(),
  search:z.object({query:z.string().min(1).max(500),thread_id:z.string().max(128).optional(),limit,before}).strict(),
  events:z.object({after:z.number().int().nonnegative().default(0),limit}).strict(),
  coverage:z.object({}).strict()
};
const adminSchemas={login:z.object({}).strict(),resume:z.object({}).strict(),disconnect:z.object({}).strict(),shutdown:z.object({}).strict()};
export function validate(method,args={}) {
  const schema=Object.hasOwn(readSchemas,method)?readSchemas[method]:Object.hasOwn(adminSchemas,method)?adminSchemas[method]:null;
  if(!schema) throw new Error('UNKNOWN_METHOD');
  return schema.parse(args);
}
