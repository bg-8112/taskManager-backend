const express = require('express');
const cors = require('cors');
const pool = require('./db');
const moment = require('moment');
const {sendSlackNotification} = require('./slack/slackService');


const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Task Manager API');
});

const DEFAULT_CHANNEL = '#tasks-manager' ;

app.post('/api/team-members', async (req, res) => {
  const { name, email } = req.body;

  try {
    // Check if the user already exists in the database
    const result = await pool.query(
      'SELECT id FROM team_members WHERE email = $1 LIMIT 1',
      [email]
    );

    if (result.rows.length > 0) {
      // User already exists in the database, return the existing user
      return res.status(200).json({ message: 'User already exists', user: result.rows[0] });
    }

    // Insert new user into the team_members table
    const insertResult = await pool.query(
      'INSERT INTO team_members (name, email) VALUES ($1, $2) RETURNING id',
      [name, email]
    );

    const newUser = insertResult.rows[0];
    res.status(201).json(newUser);  // Return the newly inserted user

  } catch (err) {
    console.error('Error inserting team member:', err);
    res.status(500).send('Error inserting team member');
  }
});

app.get('/api/tasks' , async(req,res) => {
  try{
    const result = await pool.query(
      `SELECT tasks.*, 
              COALESCE(COUNT(task_comments.id), 0) AS comment_count
       FROM tasks
       LEFT JOIN task_comments ON tasks.id = task_comments.task_id
       GROUP BY tasks.id`);
    res.json(result.rows);
  }catch(err){
    console.error('Error Fetching tasks:' , err);
    res.status(500).send('Error fetching tasks');
  }
} );

app.post('/api/tasks', async (req, res) => {
  const { title, description, assignee, due_date, priority, status, comments } = req.body;

  try {

    const assigneeResult = await pool.query(
      'SELECT id FROM team_members WHERE name = $1 LIMIT 1',
      [assignee]
    );
    if (assigneeResult.rows.length === 0) {
      return res.status(400).send('Assignee not found');
    }

    const assignee_id = assigneeResult.rows[0].id;

    const result = await pool.query(
      `INSERT INTO tasks (title, description, assignee, assignee_id, due_date, priority, status, comments)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [title, description, assignee, assignee_id, due_date, priority, status, comments]
    );

    await sendSlackNotification("new message" , "#social")
   
    await sendSlackNotification(`New Task "${title}" hss been assigned to "${assignee}" , due on ${moment(due_date).format('ddd DD-MM-YYYY')}` , DEFAULT_CHANNEL);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating task:', err);
    res.status(500).send('Error creating task');
  }
});


app.put('/api/tasks/:id', async (req, res) => {
  const { id } = req.params;
  const { title, description, assignee, due_date, priority, status, comments } = req.body;


  try {
    // Get current task data before update (for comparison)
    const currentTaskResult = await pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
    if (currentTaskResult.rows.length === 0) {
      return res.status(400).send('Task not found');
    }
    const currentTask = currentTaskResult.rows[0];

    // Compare fields to see if there's any change
    const changes = {};

    if (currentTask.title !== title) changes.title = title;
    if (currentTask.description !== description) changes.description = description;
    if (currentTask.status !== status) changes.status = status;
    if (currentTask.priority !== priority) changes.priority = priority;
    if (currentTask.comments !== comments && comments !== undefined && comments !== null && comments!== '') changes.comments = comments;

    const currentDueDate = moment(currentTask.due_date).format('YYYY-MM-DD');
    const newDueDate = moment(due_date).format('YYYY-MM-DD');
    if (currentDueDate !== newDueDate) changes.due_date = due_date;

    if (currentTask.assignee !== assignee) {
      const assigneeResult = await pool.query(
        'SELECT id FROM team_members WHERE name = $1 LIMIT 1',
        [assignee]
      );
      if (assigneeResult.rows.length === 0) {
        return res.status(400).send('Assignee not found');
      }
      changes.assignee = assignee;
    }

    // If there are no changes, return the current task without updating
   
    if (Object.keys(changes).length === 0) {
      // console.log('No changes detected. Returning current task:', currentTask);
      return res.json(currentTask);
    }

    // Update task only if there are changes
    const assignee_id = assignee ? (await pool.query('SELECT id FROM team_members WHERE name = $1 LIMIT 1', [assignee])).rows[0].id : currentTask.assignee_id;

    const result = await pool.query(
      `UPDATE tasks
       SET title = $1, description = $2, assignee = $3, assignee_id = $4, due_date = $5, priority = $6, status = $7, comments = $8
       WHERE id = $9
       RETURNING *`,
      [
        changes.title || currentTask.title,
        changes.description || currentTask.description,
        changes.assignee || currentTask.assignee,
        assignee_id,
        changes.due_date || currentTask.due_date,
        changes.priority || currentTask.priority,
        changes.status || currentTask.status,
        changes.comments || currentTask.comments,
        id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(400).send('Task not found');
    }

    const updatedTask = result.rows[0];

    if (changes.comments) {
      await pool.query(
        'INSERT INTO task_comments (task_id, comment, created_at) VALUES ($1, $2, NOW())',
        [id, changes.comments]
      );
    }

        
    await sendSlackNotification(`Task "${updatedTask.title}" has been updated` , DEFAULT_CHANNEL)

    // Log the activity
    let activity = '';
    if (currentTask.title !== updatedTask.title) {
      activity += `Title changed from "${currentTask.title}" to "${updatedTask.title}". `;
      console.log("title has been changed");
    }
    if (currentTask.description !== updatedTask.description) {
      activity += `Description changed `;
      console.log("description has been changed");
    }
    if (currentTask.status !== updatedTask.status) {
      activity += `Status changed from ${currentTask.status} to ${updatedTask.status}. `;
      console.log("status has been changed");
    }
    if (currentTask.priority !== updatedTask.priority) {
      activity += `Priority changed from ${currentTask.priority} to ${updatedTask.priority}. `;
      console.log("priority has been changed");
    }
    const formatCurrentDue = moment(currentTask.due_date).format('YYYY-MM-DD');
    const formatUpdatedDue = moment(updatedTask.due_date).format('YYYY-MM-DD');
    if (formatCurrentDue !== formatUpdatedDue) {
      activity += `Due date changed from ${moment(currentTask.due_date).format('ddd DD-MM-YYYY')} to ${moment(updatedTask.due_date).format('ddd DD-MM-YYYY')}. `;
      console.log("due date has been changed" , formatCurrentDue , formatUpdatedDue);
    }
    if (currentTask.comments !== updatedTask.comments) {
      activity += `User added a comment: ${updatedTask.comments}`;
      console.log("comment is added");
    }
    if (currentTask.assignee !== updatedTask.assignee) {
      activity += `Assignee changed from ${currentTask.assignee} to ${updatedTask.assignee}`;
      console.log("assignee modified");
    }

    // Insert log into task_activity_logs
    await pool.query(
      `INSERT INTO task_activity_logs (task_id, activity)
       VALUES ($1, $2)`,
      [id, activity]
    );

    res.json(updatedTask);
  } catch (err) {
    console.error('Error updating task:', err);
    res.status(500).send('Error updating the task');
  }
});

app.delete('/api/tasks/:id', async (req, res) => {
  const { id } = req.params;

  try {
    // Check if the task exists in the database
    const taskResult = await pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
    if (taskResult.rows.length === 0) {
      return res.status(400).send('Task not found');
    }

    // Delete the task from the tasks table
    const deleteResult = await pool.query('DELETE FROM tasks WHERE id = $1 RETURNING *', [id]);
    
    if (deleteResult.rows.length === 0) {
      return res.status(400).send('Error deleting task');
    }

    // Optionally, delete associated comments (if any) from task_comments table
    await pool.query('DELETE FROM task_comments WHERE task_id = $1', [id]);

    // Send a notification about the task deletion (optional)
    await sendSlackNotification(`Task "${deleteResult.rows[0].title}" has been deleted`, DEFAULT_CHANNEL);

    res.status(200).send('Task deleted successfully');
  } catch (err) {
    console.error('Error deleting task:', err);
    res.status(500).send('Error deleting task');
  }
});


app.get('/api/task-activity-log/:taskId', async (req, res) => {
  const { taskId } = req.params;

  try {
    const result = await pool.query(
      'SELECT * FROM task_activity_logs WHERE task_id = $1 ORDER BY created_at ASC', // Oldest to newest
      [taskId]
    );

    if (result.rows.length === 0) {
      return res.status(404).send('No activity logs found for this task');
    }

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching activity logs:', err);
    res.status(500).send('Error fetching activity logs');
  }
});

//team-members
app.get('/api/team-members', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM team_members');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching team members:', err);
    res.status(500).send('Error fetching team members');
  }
});



app.listen(port , ()=>{
  console.log(`Server running on http://localhost:${port} `)

});