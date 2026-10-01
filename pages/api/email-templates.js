import { db, admin } from '../../lib/firebase';
import { requireAuth } from '../../lib/withAuth';
export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  if (!db) {
    return res.status(500).json({
      error: 'Firebase not initialized',
      message: 'Please check your Firebase configuration in .env.local'
    });
  }

  try {
    switch (req.method) {
      case 'GET':
        return await listEmailTemplates(req, res);
      case 'POST':
        return await createEmailTemplate(req, res);
      case 'PUT':
        return await updateEmailTemplate(req, res);
      case 'DELETE':
        return await deleteEmailTemplate(req, res);
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Email templates API error:', error);
    return res.status(500).json({
      error: 'Failed to process request',
      message: error.message,
    });
  }
}

async function listEmailTemplates(req, res) {
  const snapshot = await db.collection('email-templates')
    .orderBy('createdAt', 'desc')
    .get();

  const templates = snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
    createdAt: doc.data().createdAt?.toDate?.()?.toISOString() || doc.data().createdAt,
    updatedAt: doc.data().updatedAt?.toDate?.()?.toISOString() || doc.data().updatedAt,
  }));

  return res.status(200).json({ templates });
}

async function createEmailTemplate(req, res) {
  const {
    name,
    slug,
    category,
    audience,
    subject,
    previewText,
    htmlContent,
    variables,
    description,
  } = req.body;

  // Validation
  if (!name || !slug || !subject || !htmlContent) {
    return res.status(400).json({ error: 'Name, slug, subject, and HTML content are required' });
  }

  const normalizedSlug = slug.toLowerCase().trim().replace(/\s+/g, '-');

  // Check if slug already exists
  const existingSnapshot = await db.collection('email-templates')
    .where('slug', '==', normalizedSlug)
    .limit(1)
    .get();

  if (!existingSnapshot.empty) {
    return res.status(400).json({ error: 'Template with this slug already exists' });
  }

  const templateData = {
    name: name.trim(),
    slug: normalizedSlug,
    category: category || 'general',
    audience: audience || '',
    subject: subject.trim(),
    previewText: previewText?.trim() || '',
    htmlContent: htmlContent,
    variables: variables || [],
    description: description?.trim() || '',
    isActive: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const docRef = await db.collection('email-templates').add(templateData);

  return res.status(201).json({
    id: docRef.id,
    ...templateData,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

async function updateEmailTemplate(req, res) {
  const { id, ...updates } = req.body;

  if (!id) {
    return res.status(400).json({ error: 'Template ID is required' });
  }

  const docRef = db.collection('email-templates').doc(id);
  const doc = await docRef.get();

  if (!doc.exists) {
    return res.status(404).json({ error: 'Template not found' });
  }

  // Build allowed updates
  const allowedUpdates = {
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  // Slug update - check for duplicates if changing
  if (updates.slug !== undefined) {
    const normalizedSlug = updates.slug.toLowerCase().trim().replace(/\s+/g, '-');
    const currentData = doc.data();

    if (normalizedSlug !== currentData.slug) {
      const existingSnapshot = await db.collection('email-templates')
        .where('slug', '==', normalizedSlug)
        .limit(1)
        .get();

      if (!existingSnapshot.empty) {
        return res.status(400).json({ error: 'Template with this slug already exists' });
      }
    }
    allowedUpdates.slug = normalizedSlug;
  }

  if (updates.name !== undefined) {
    allowedUpdates.name = updates.name.trim();
  }
  if (updates.category !== undefined) {
    allowedUpdates.category = updates.category;
  }
  if (updates.audience !== undefined) {
    allowedUpdates.audience = updates.audience;
  }
  if (updates.subject !== undefined) {
    allowedUpdates.subject = updates.subject.trim();
  }
  if (updates.previewText !== undefined) {
    allowedUpdates.previewText = updates.previewText?.trim() || '';
  }
  if (updates.htmlContent !== undefined) {
    allowedUpdates.htmlContent = updates.htmlContent;
  }
  if (updates.variables !== undefined) {
    allowedUpdates.variables = updates.variables;
  }
  if (updates.description !== undefined) {
    allowedUpdates.description = updates.description?.trim() || '';
  }
  if (updates.isActive !== undefined) {
    allowedUpdates.isActive = updates.isActive;
  }

  await docRef.update(allowedUpdates);

  return res.status(200).json({ id, ...allowedUpdates });
}

async function deleteEmailTemplate(req, res) {
  const { id } = req.body;

  if (!id) {
    return res.status(400).json({ error: 'Template ID is required' });
  }

  const docRef = db.collection('email-templates').doc(id);
  const doc = await docRef.get();

  if (!doc.exists) {
    return res.status(404).json({ error: 'Template not found' });
  }

  await docRef.delete();

  return res.status(200).json({ success: true });
}
